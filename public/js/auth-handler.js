

class AuthHandler {
  
  static handleAuthRequired(result, action = "perform this action") {
    if (result.requiresAuth || result.message?.includes('log in')) {
      this.showAuthRequiredDialog(action, result.redirectTo || '/login');
      return true;
    }
    return false;
  }

  
  static showAuthRequiredDialog(action, redirectUrl = '/login') {
    Swal.fire({
      title: 'Sign In Required',
      text: `Please sign in to ${action}`,
      icon: 'info',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Sign In',
      cancelButtonText: 'Continue Browsing',
      reverseButtons: true,
      customClass: {
        popup: 'auth-required-popup',
        title: 'auth-required-title',
        content: 'auth-required-content'
      }
    }).then((result) => {
      if (result.isConfirmed) {
        sessionStorage.setItem('redirectAfterLogin', window.location.pathname);
        window.location.href = redirectUrl;
      }
    });
  }

  static handleSuccess(result, action = "Operation completed") {
    if (result.cartCount !== undefined) {
      const cartCountElement = document.querySelector('.cart-count');
      if (cartCountElement) {
        cartCountElement.textContent = result.cartCount;
        cartCountElement.dataset.count = result.cartCount;
      }
    }

    if (result.wishlistCount !== undefined) {
      const wishlistCountElement = document.querySelector('.wishlist-count');
      if (wishlistCountElement) {
        wishlistCountElement.textContent = result.wishlistCount;
        wishlistCountElement.dataset.count = result.wishlistCount;
      }
    }

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: result.message || action,
      showConfirmButton: false,
      timer: 1500,
      timerProgressBar: true
    });
  }

  
  static handleError(result, defaultMessage = "An error occurred") {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'error',
      title: result.message || defaultMessage,
      showConfirmButton: false,
      timer: 2000,
      timerProgressBar: true
    });
  }


  static async handleApiCall(url, data, successAction, errorAction) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        this.handleSuccess(result, successAction);
        return { success: true, result };
      } else {
        if (this.handleAuthRequired(result, errorAction)) {
          return { success: false, authRequired: true };
        }
        
        this.handleError(result, `Failed to ${errorAction}`);
        return { success: false, result };
      }
    } catch (error) {
      console.error(`Error in ${errorAction}:`, error);
      this.handleError({}, `Error ${errorAction}`);
      return { success: false, error };
    }
  }

  
  static async addToCart(productId, quantity = 1) {
    return await this.handleApiCall(
      '/cart/add',
      { productId, quantity },
      'Item added to cart',
      'add to cart'
    );
  }

  
  static async toggleWishlist(productId) {
    return await this.handleApiCall(
      '/wishlist/toggle',
      { productId },
      'Wishlist updated',
      'update wishlist'
    );
  }
}

window.AuthHandler = AuthHandler;

const authStyles = `
<style>
.auth-required-popup {
  border-radius: 15px !important;
}

.auth-required-title {
  color: #2c3e50 !important;
  font-weight: 600 !important;
}

.auth-required-content {
  color: #5a6c7d !important;
  font-size: 16px !important;
}

.swal2-confirm {
  background-color: #3085d6 !important;
  border-radius: 8px !important;
  font-weight: 500 !important;
  padding: 10px 24px !important;
}

.swal2-cancel {
  background-color: #6c757d !important;
  border-radius: 8px !important;
  font-weight: 500 !important;
  padding: 10px 24px !important;
}
</style>
`;

// Inject styles
document.head.insertAdjacentHTML('beforeend', authStyles);
